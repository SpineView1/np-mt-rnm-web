import os
import glob
import pandas as pd
import networkx as nx
import matplotlib
matplotlib.use("Agg")  # non-interactive backend (Django worker thread, headless servers)
import matplotlib.pyplot as plt
from django.conf import settings
import libsbml
import roadrunner
import uuid
import json
import numpy as np
import logging
from django.http import JsonResponse, FileResponse, HttpResponse
from django.shortcuts import render
from django.views import View
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
import tempfile
from rest_framework.views import APIView
from django.core.exceptions import ValidationError
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
import shutil
from rest_framework.response import Response
from rest_framework import status
import traceback
import tellurium as te

logger = logging.getLogger(__name__)

# Add at the top of your file
FIXED_ORDER = [
    # Mechanical inputs & mechanosensors
    'Hypo', 'NL', 'HL', 'alpha5beta1_FN', 'alpha5beta1_Fs', 'alphaVbeta3', 'alphaVbeta6', 
    'SDC4_E', 'SDC4_M', 'TRPV4', 'PIEZO1', 
    # Ion channels & related (Ca2+ signalling)
    'Ca2plusos', 'Ca2plussu', 'CaMKII', 'PKC_E', 'PKC_M', 'PLCgamma_M', 'PLCgamma_E', 'CaN', 
    'IP3', 'PLA2', 'AQP1', 'AQP5', 
    # Rho GTPases, cytoskeletal & Hippo regulators
    'RhoA_M', 'RhoA_E', 'RAC1_M', 'RAC1_E', 'CDC42', 'ROCK_M', 'ROCK_E', 'PAK1', 'PKN1', 
    'FAK_M', 'FAK_E', 'MST1_2', 'LATS1_2', 
    # MAPK & stress-activated kinases
    'RAS_M', 'RAS_E', 'RAF_M', 'RAF_E', 'MEK_M', 'MEK_E', 'ERK_M', 'ERK_E', 'MKK3_6', 'MKK4_7', 
    'JNK', 'P38', 'RSK', 'TAK1', 
    # Metabolic & related
    'LKB1', 'NADplus', 'AMPK', 'mTORC1', 'mTORC2', 'SIRT1', 'PI3K_M', 'PI3K_E', 'PIP3_M', 
    'PIP3_E', 'PDK1_M', 'PDK1_E', 'AKT1_M', 'AKT1_E', 'GSK3B', 'ULK1', 'PTEN', 'PLD2', 'PGE2', 
    'COX_2', 'CAT', 'GPX1', 'SOD1', 'SOD2', 'HO_1', 'PHD2', 'VHL', 'Rheb', 'NutD', 'MitD', 
    # Oxidative-stress defense & proteostasis
    'HSP70', 'HSP27', 'ROS', 
    # Transcription factors
    'CREB', 'HIF_1alpha', 'HIF_2alpha', 'NF_kappaB', 'AP_1', 'FOXO', 'SOX9', 'NFAT', 'RUNX2', 
    'YAP_TAZ', 'MRTF_A', 'NRF2', 'HSF1', 'TonEBP', 'ELK1', 'PPARgamma', 'CITED2', 
    # Growth factors
    'TGFbeta', 'VEGF', 'IGF1', 'BMP2', 'CCN2', 'GDF5', 'FGF2', 'FGF18', 'Wnt3a', 'Wnt5a', 
    # ECM anabolism & phenotype markers
    'COL2A1', 'COL1A1', 'COL10A1', 'ACAN', 'TIMP3', 
    # Cytokines, chemokines, proteases
    'TNF', 'IL6', 'IL1beta', 'IL8', 'CCL2', 'CXCL1', 'CXCL3', 'ADAMTS4_5', 'MMP1', 'MMP3', 
    'MMP13', 
    # Cell survival, apoptosis, mitophagy
    'Bcl2', 'BAX', 'CASP3', 'CASP9', 'BNIP3', 'GADD45', 'DRP1', 'MOMP', 
    # Other regulators
    'ANXA1', 'BAD', 'DAG', 'IKK', 'iNOS', 'IkappaBalpha', 'LIMK1', 'MAP3K', 'SMIT1', 'SOX5', 
    'SOX6', 'TAUT', 'beta_catenin', 
]



# Define model classes (Compartment, Species, Reaction, UnitDefinition, Parameter, Event)
class Compartment:
    def __init__(self, id, name, size):
        self.id = id
        self.name = name
        self.size = size

class Species:
    def __init__(self, id, name, metaid, substance_units, has_only_substance_units, initial_value, compartment, charge):
        self.id = id
        self.name = name
        self.metaid = metaid
        self.substance_units = substance_units
        self.has_only_substance_units = has_only_substance_units
        self.initial_value = initial_value
        self.compartment = compartment
        self.charge = charge

def _initial_value(species):
    """Return a species' initial value, preferring whichever attribute is set.

    Species in this SBML are emitted with ``initialAmount`` (and
    ``hasOnlySubstanceUnits=true``) — ``getInitialConcentration()`` returns NaN
    for those, which serializes as invalid JSON and breaks the Node Tray on
    the front-end. Use the amount when concentration isn't set.
    """
    if species.isSetInitialConcentration():
        v = species.getInitialConcentration()
    elif species.isSetInitialAmount():
        v = species.getInitialAmount()
    else:
        v = 0.0
    # Guard against any residual NaN (NaN -> 0.0; JSON-safe).
    try:
        import math
        return 0.0 if math.isnan(v) else float(v)
    except (TypeError, ValueError):
        return 0.0


class Reaction:
    def __init__(self, id, name, metaid, reactants, products, modifiers, math):
        self.id = id
        self.name = name
        self.metaid = metaid
        self.reactants = reactants
        self.products = products
        self.modifiers = modifiers
        self.math = math
        self.reactants_products = f"Reactants: {self.reactants}<br>Products: {self.products}"

class UnitDefinition:
    def __init__(self, id, name, metaid, units):
        self.id = id
        self.name = name
        self.metaid = metaid
        self.units = units

class Parameter:
    def __init__(self, id, name, metaid, units, value):
        self.id = id
        self.name = name
        self.metaid = metaid
        self.units = units
        self.value = value

class Event:
    def __init__(self, id, name):
        self.id = id
        self.name = name

class RateRule:
    """Rate rule (dX/dt = formula) — the unit of dynamics for rate-rule-based SBML
    such as this SQUADS / Mendoza network (where there are no <reaction> elements
    but every species carries an ODE as a RateRule)."""
    def __init__(self, variable, formula):
        self.variable = variable
        self.formula = formula

class ViewSBML(APIView):
    def get(self, request, format=None):
        try:
            sbml_files = self._find_sbml_files()
            if not sbml_files:
                return self._render_error(request, "No SBML files found in the directory.")

            temp_sbml_path = self._create_temp_file(request, sbml_files[0])
            request.session['temp_sbml_path'] = temp_sbml_path
            
            # Store original concentrations
            original_concentrations = self._get_initial_concentrations(temp_sbml_path)
            request.session['original_concentrations'] = original_concentrations

            # Reset clamped nodes for new session
            request.session['clamped_nodes'] = {}

            model_data, errors = self._parse_sbml(temp_sbml_path)
            if errors:
                return self._render_error(request, errors)

            return render(request, 'view_sbml.html', {
                'model_data': model_data,
                'session_key': request.session.session_key
            })

        except Exception as e:
            logger.exception("Unexpected error in ViewSBML")
            return self._render_error(request, "An unexpected error occurred.")

    def _get_initial_concentrations(self, sbml_file_path):
        reader = libsbml.SBMLReader()
        document = reader.readSBML(sbml_file_path)
        model = document.getModel()
        return {sp.getId(): _initial_value(sp) for sp in model.getListOfSpecies()}

    def _find_sbml_files(self):
        base_dir = settings.BASE_DIR
        return glob.glob(os.path.join(base_dir, '*.xml'))

    def _create_temp_file(self, request, original_file):
        temp_models_dir = os.path.join(settings.MEDIA_ROOT, 'temp_models')
        os.makedirs(temp_models_dir, exist_ok=True)

        temp_file_name = f'model_{request.session.session_key}.xml'
        temp_file_path = os.path.join(temp_models_dir, temp_file_name)

        shutil.copy2(original_file, temp_file_path)

        return temp_file_path

    def _parse_sbml(self, file_path):
        reader = libsbml.SBMLReader()
        document = reader.readSBML(file_path)
        
        if document.getNumErrors() > 0:
            errors = document.getErrorLog().toString()
            return None, errors
        
        model = document.getModel()
        
        if model is None:
            return None, "No model found in the SBML file."
        
        model_data = {
                'model_id': model.getId(),
                'model_name': model.getName(),
                'num_compartments': model.getNumCompartments(),
                'num_species': model.getNumSpecies(),
                'num_reactions': model.getNumReactions(),
                'num_parameters': model.getNumParameters(),
                'num_events': model.getNumEvents(),
                'compartments': [],
                'species': [],
                'reactions': [],
                'rate_rules': [],
                'num_rate_rules': 0,
                'parameters': [],
                'events': [],
                'unit_definitions': [],
                'model_metadata': None
            }

        for i in range(model.getNumCompartments()):
            compartment = model.getCompartment(i)
            model_data['compartments'].append(Compartment(compartment.getId(), compartment.getName(), compartment.getSize()))

        for i in range(model.getNumSpecies()):
            species = model.getSpecies(i)
            model_data['species'].append(Species(
                species.getId(),
                species.getName(),
                species.getMetaId(),
                species.getSubstanceUnits(),
                species.getHasOnlySubstanceUnits(),
                species.getInitialAmount(),
                species.getCompartment(),
                species.getCharge()
            ))
        
        num_unit_definitions = model.getNumUnitDefinitions()
        for i in range(num_unit_definitions):
            unit_definition = model.getUnitDefinition(i)
            units = "; ".join([f"{libsbml.UnitKind_toString(unit.getKind())} ({unit.getExponent()})" for unit in unit_definition.getListOfUnits()])
            model_data['unit_definitions'].append(UnitDefinition(
                unit_definition.getId(),
                unit_definition.getName(),
                unit_definition.getMetaId(),
                units
            ))

        for i in range(model.getNumReactions()):
            reaction = model.getReaction(i)
            equation = libsbml.formulaToL3String(reaction.getKineticLaw().getMath())
            
            reactants = "; ".join([f"{reactant.getSpecies()} ({reactant.getStoichiometry()})" if reactant.isSetStoichiometry() else reactant.getSpecies() for reactant in reaction.getListOfReactants()])
            products = "; ".join([f"{product.getSpecies()} ({product.getStoichiometry()})" if product.isSetStoichiometry() else product.getSpecies() for product in reaction.getListOfProducts()])
            
            modifiers = "; ".join([modifier.getSpecies() for modifier in reaction.getListOfModifiers()])
            
            model_data['reactions'].append(Reaction(
                reaction.getId(),
                reaction.getName(),
                reaction.getMetaId(),
                reactants,
                products,
                modifiers,
                equation
        ))

        # Rate rules — primary mechanism of dynamics for rate-rule-based SBML.
        # The macrophage SQUADS model has 0 <reaction>s but one RateRule per
        # species: dX/dt = sigmoid(omega(activators, inhibitors); h) - gamma*X.
        for i in range(model.getNumRules()):
            rule = model.getRule(i)
            if rule.isRate():
                formula = libsbml.formulaToL3String(rule.getMath()) if rule.isSetMath() else ""
                model_data['rate_rules'].append(RateRule(rule.getVariable(), formula))
        model_data['num_rate_rules'] = len(model_data['rate_rules'])

        for i in range(model.getNumParameters()):
            parameter = model.getParameter(i)
            model_data['parameters'].append(Parameter(
                parameter.getId(),
                parameter.getName(),
                parameter.getMetaId(),  # Get metaid
                parameter.getUnits(),   # Get units
                parameter.getValue()
            ))

        for i in range(model.getNumEvents()):
            event = model.getEvent(i)
            model_data['events'].append(Event(event.getId(), event.getName()))

        # Extract model metadata
        model_metadata = ""
        if model.isSetNotes():
            notes_string = model.getNotesString()
            # Remove XML/XHTML tags and unescape HTML entities
            import re
            from html import unescape
            
            # Remove the notes tags
            notes_string = re.sub(r'<\/?notes>', '', notes_string)
            # Remove the xmlns attribute
            notes_string = re.sub(r'\sxmlns="[^"]+"', '', notes_string)
            # Remove body tags
            notes_string = re.sub(r'<\/?body>', '', notes_string)
            
            model_metadata = unescape(notes_string).strip()

        model_data['model_metadata'] = model_metadata
        errors = None
        return model_data, errors

    def _render_error(self, request, error_message):
        return render(
            request, 
            'error.html', 
            {'error_message': error_message}, 
            status=status.HTTP_400_BAD_REQUEST
        )

def add_brackets(name):
    return f"[{name}]" if not name.startswith('[') else name

def remove_brackets(name):
    return name.strip('[]')

@method_decorator(csrf_exempt, name='dispatch')
class RunSimulation(APIView):
    def get_baseline_values(self):
        return {
        'ACAN': 0.9984622943107997,
        'ADAMTS4_5': 8.591783134681537e-07,
        'AKT1_E': 1.8422907144047045e-11,
        'AKT1_M': 0.9301780569782357,
        'AMPK': 0.0006896923987706441,
        'ANXA1': 0.9998005918699134,
        'AP_1': 2.9621602979030406e-07,
        'AQP1': 0.9971411206053161,
        'AQP5': 0.9971411206053161,
        'BAD': 2.3787317440479474e-07,
        'BAX': 8.411904804452015e-08,
        'BMP2': 8.994682809474339e-07,
        'BNIP3': 0.9983354829599391,
        'Bcl2': 0.991095673618952,
        'CASP3': 3.330757657526594e-14,
        'CASP9': 2.4713708785829066e-13,
        'CAT': 0.8337331192890716,
        'CCL2': 3.2956259726594074e-08,
        'CCN2': 0.9842890734517992,
        'CDC42': 0.999989785210422,
        'CITED2': 0.998347159001287,
        'COL10A1': 2.1089493003689874e-10,
        'COL1A1': 0.002199181305529307,
        'COL2A1': 0.998430767169909,
        'COX_2': 2.0942934418310228e-07,
        'CREB': 0.9941830266088936,
        'CXCL1': 3.2956259726594074e-08,
        'CXCL3': 3.2956259726594074e-08,
        'Ca2plusos': 0.9995247010117269,
        'Ca2plussu': 0.00014703584512140277,
        'CaMKII': 0.9999839639729213,
        'CaN': 1.4875473495243842e-05,
        'DAG': 0.9999999996093437,
        'DRP1': 1.5628235098761415e-05,
        'ELK1': 2.9474317809369176e-06,
        'ERK_E': 1.318090080942834e-07,
        'ERK_M': 0.9999999996093437,
        'FAK_E': 0.0003979826085870856,
        'FAK_M': 0.9996970843171071,
        'FGF18': 0.8659889259686656,
        'FGF2': 0.006537055264004614,
        'FOXO': 0.7814930490931572,
        'GADD45': 0.8336847741378526,
        'GDF5': 0.9878251950603526,
        'GPX1': 0.8337331192890716,
        'GSK3B': 6.804542385432264e-07,
        'HIF_1alpha': 0.9570057442730018,
        'HIF_2alpha': 5.286955491120391e-10,
        'HL': 0.01,
        'HO_1': 0.9173621539848548,
        'HSF1': 0.9210924953713785,
        'HSP27': 0.9965889840976021,
        'HSP70': 0.9964820558831616,
        'Hypo': 0.01,
        'IGF1': 0.9999854678634695,
        'IKK': 0.0010810366528499866,
        'IL1beta': 0.005874181792824894,
        'IL6': 0.005874181792824894,
        'IL8': 3.2956259726594074e-08,
        'IP3': 1.1312686199748935e-10,
        'IkappaBalpha': 0.9968695713657915,
        'JNK': 4.8796338732475356e-05,
        'LATS1_2': 0.0701018735691385,
        'LIMK1': 0.844516987912804,
        'LKB1': 1.6995374522058304e-06,
        'MAP3K': 2.9023937460823545e-05,
        'MEK_E': 9.78056745491294e-07,
        'MEK_M': 0.9999999884048159,
        'MKK3_6': 3.9124192957693204e-06,
        'MKK4_7': 3.9124192957693204e-06,
        'MMP1': 8.752465451388612e-06,
        'MMP13': 1.044401342986931e-05,
        'MMP3': 8.752465451388612e-06,
        'MOMP': 5.069677630695346e-11,
        'MRTF_A': 0.8711744618514322,
        'MST1_2': 0.9999999884048159,
        'MitD': 0.00016472654051739505,
        'NADplus': 9.349051860817874e-05,
        'NFAT': 2.004958467691922e-06,
        'NF_kappaB': 2.984488536264584e-08,
        'NL': 0.8,
        'NRF2': 7.130405483235003e-05,
        'NutD': 0.0014734271172591848,
        'P38': 4.8796338732475356e-05,
        'PAK1': 0.9864531741122851,
        'PDK1_E': 1.6551369926772148e-08,
        'PDK1_M': 0.9999999884048159,
        'PGE2': 0.833465243615064,
        'PHD2': 0.998347159001287,
        'PI3K_E': 5.382378642853365e-05,
        'PI3K_M': 0.999989785210422,
        'PIEZO1': 0.0014413752010535724,
        'PIP3_E': 1.2281634805614722e-07,
        'PIP3_M': 0.999999655840393,
        'PKC_E': 0.00016218774197549778,
        'PKC_M': 0.9997954393790448,
        'PKN1': 7.257028136647834e-06,
        'PLA2': 0.7811694907553716,
        'PLCgamma_E': 1.655136992677214e-08,
        'PLCgamma_M': 0.9999999884048159,
        'PLD2': 0.009271557888159126,
        'PPARgamma': 0.8107849934641125,
        'PTEN': 0.9666986439831982,
        'RAC1_E': 2.73823199851328e-10,
        'RAC1_M': 0.9999825184300414,
        'RAF_E': 7.257028136647834e-06,
        'RAF_M': 0.999999655840393,
        'RAS_E': 5.382378642853365e-05,
        'RAS_M': 0.999989785210422,
        'ROCK_E': 7.257028136647834e-06,
        'ROCK_M': 0.999999655840393,
        'ROS': 0.0001395937745835616,
        'RSK': 0.9999999999868384,
        'RUNX2': 9.68489569587376e-06,
        'Rheb': 0.9840321003066876,
        'RhoA_E': 5.382378642853365e-05,
        'RhoA_M': 0.999989785210422,
        'SDC4_E': 0.0014413752010535724,
        'SDC4_M': 0.9826345854560272,
        'SIRT1': 1.2609703705220611e-05,
        'SMIT1': 0.9912758944757152,
        'SOD1': 9.615372237337612e-06,
        'SOD2': 0.8337331192890713,
        'SOX5': 0.9999854678634695,
        'SOX6': 0.9999854678634695,
        'SOX9': 0.9995692185700991,
        'TAK1': 2.9023937460823545e-05,
        'TAUT': 0.9912758944757152,
        'TGFbeta': 0.8464114426085919,
        'TIMP3': 0.9969065309426658,
        'TNF': 2.0942934418310228e-07,
        'TRPV4': 0.9864539915561671,
        'TonEBP': 0.845779982853073,
        'ULK1': 1.358937564482025e-06,
        'VEGF': 0.8249177798750534,
        'VHL': 0.9999250653726504,
        'Wnt3a': 9.029621778274489e-06,
        'Wnt5a': 0.008661432814042597,
        'YAP_TAZ': 0.8244958852107688,
        'alpha5beta1_FN': 0.9826345854560272,
        'alpha5beta1_Fs': 0.0014413752010535724,
        'alphaVbeta3': 0.0014413752010535724,
        'alphaVbeta6': 0.9826345854560272,
        'beta_catenin': 0.04887913927502225,
        'iNOS': 3.2951560587524235e-08,
        'mTORC1': 0.971163298100047,
        'mTORC2': 0.0010603356001350234,
        }

    def post(self, request, format=None):
        try:
            data = json.loads(request.body)
            execution_start = 0
            execution_end = 30
            execution_steps = 100

            sbml_file_path = request.session.get('temp_sbml_path', '')
            if not sbml_file_path or not os.path.exists(sbml_file_path):
                return JsonResponse({'success': False, 'message': 'Temporary SBML file not found.'})

            # Load model
            r = te.loadSBMLModel(sbml_file_path)

            # Initialize with baseline values if no last state
            if 'last_state' not in request.session:
                request.session['last_state'] = self.get_baseline_values()

            # Set initial conditions from last state
            last_state = request.session['last_state']
            for species, value in last_state.items():
                try:
                    r[species] = value
                except Exception as e:
                    logger.error(f"Error setting {species}: {str(e)}")
                    continue

            # Get clamped nodes
            clamped_nodes = request.session.get('clamped_nodes', {})

            # Run simulation with proper clamping
            result = []
            time_points = np.linspace(execution_start, execution_end, execution_steps)

            for t in np.diff(time_points):
                # Apply clamps at each step
                for species_id, value in clamped_nodes.items():
                    try:
                        r[species_id] = value
                    except Exception as e:
                        logger.error(f"Error clamping {species_id}: {str(e)}")
                        continue

                # Simulate one step
                r.simulate(0, t, 2)
                state = r.getFloatingSpeciesConcentrations()
                result.append(state)

            result = np.array(result)
            species_names = r.getFloatingSpeciesIds()

            # Get initial state (last state from previous simulation)
            initial_state = request.session.get('last_state', self.get_baseline_values())

            # Get final state (floating species)
            final_state = {
                species_id: result[-1][i]
                for i, species_id in enumerate(species_names)
            }

            # Also include boundary species — for this model the three mechanical
            # loading inputs (Hypo, NL, HL) are boundary species and would otherwise
            # be missing from the bar plot when not explicitly clamped.
            try:
                for sid in r.model.getBoundarySpeciesIds():
                    final_state.setdefault(sid, float(r[sid]))
            except Exception:
                pass

            # Add clamped values to final state (clamps override)
            final_state.update(clamped_nodes)

            # Update session state for next simulation
            request.session['last_state'] = final_state

            # Generate plot with both initial and final concentrations
            bar_plot_url = self._generate_bar_plot(
                species_names=FIXED_ORDER,
                concentrations=final_state,
                initial_concentrations=initial_state
            )

            return JsonResponse({
                'success': True,
                'initial_concentrations': initial_state,
                'final_concentrations': final_state,
                'bar_plot_url': bar_plot_url
            })

        except Exception as e:
            logger.error(f"Error in RunSimulation: {str(e)}")
            logger.error(f"Traceback: {traceback.format_exc()}")
            return JsonResponse({
                'success': False,
                'message': str(e),
                'traceback': traceback.format_exc()
            }, status=500)

    def _generate_bar_plot(self, species_names, concentrations, initial_concentrations):
        plt.figure(figsize=(28, 9))
        
        # Use fixed order for species
        species = FIXED_ORDER
        initial_values = [initial_concentrations.get(s, 0) for s in species]
        final_values = [concentrations.get(s, 0) for s in species]  # Use get() to handle missing values
        
        x = np.arange(len(species))
        width = 0.35
        
        # Plot initial concentrations
        plt.bar(x - width/2, initial_values, width, label='Initial', color='skyblue')
        
        # Plot final concentrations
        plt.bar(x + width/2, final_values, width, label='Final', color='yellow')
        
        # Add grid and labels
        plt.xlabel('Nodes (Species)')
        plt.ylabel('Concentration')
        plt.title('Node Concentrations')
        plt.xticks(x, species, rotation=70, ha='right', fontsize=8)
        plt.grid(True, axis='y', linestyle='--', alpha=0.7)
        plt.legend()
        
        plt.tight_layout()
        
        # Save plot
        bar_plot_filename = f'bar_plot_{uuid.uuid4().hex}.png'
        with tempfile.NamedTemporaryFile(delete=False, suffix='.png') as temp_file:
            plt.savefig(temp_file.name, dpi=300, bbox_inches='tight')
            plt.close()
            with open(temp_file.name, 'rb') as f:
                bar_plot_path = default_storage.save(bar_plot_filename, ContentFile(f.read()))
        os.unlink(temp_file.name)

        return default_storage.url(bar_plot_path)
    
# Endpoint to update parameters
class UpdateParameters(APIView):
    def post(self, request, format=None):
        try:
            data = json.loads(request.body)
            
            sbml_file_path = request.session.get('temp_sbml_path', '')
            if not sbml_file_path or not os.path.exists(sbml_file_path):
                return JsonResponse({'success': False, 'message': 'Temporary SBML file not found.'})

            reader = libsbml.SBMLReader()
            document = reader.readSBML(sbml_file_path)

            if document.getNumErrors() > 0:
                errors = document.getErrorLog().toString()
                return JsonResponse({'success': False, 'message': errors})

            model = document.getModel()
            if model is None:
                return JsonResponse({'success': False, 'message': 'No model found in the SBML file.'})

            for parameter_id, new_value in data.items():
                parameter = model.getParameter(parameter_id)
                if parameter is not None:
                    parameter.setValue(float(new_value))

            writer = libsbml.SBMLWriter()
            writer.writeSBMLToFile(document, sbml_file_path)

            return JsonResponse({'success': True, 'message': 'Parameters updated successfully.'})
        except Exception as e:
            logger.error(f"Error in UpdateParameters: {str(e)}")
            return JsonResponse({'success': False, 'message': str(e)})

class DownloadSBMLView(View):
    def get(self, request, *args, **kwargs):
        try:
            # Get the temporary SBML file path from the session
            sbml_file_path = request.session.get('temp_sbml_path', '')
            if not sbml_file_path or not os.path.exists(sbml_file_path):
                # If temp file not found, try the default path
                file_name = 'autogenerated_model.xml'
                sbml_file_path = os.path.join(settings.BASE_DIR, file_name)

            if not os.path.exists(sbml_file_path):
                return HttpResponse(f"SBML file not found at {sbml_file_path}", status=404)
            
            if not os.access(sbml_file_path, os.R_OK):
                return HttpResponse(f"Permission denied: Cannot read SBML file at {sbml_file_path}", status=403)

            # Create response with file
            file_obj = open(sbml_file_path, 'rb')
            response = FileResponse(
                file_obj,
                content_type='application/xml',
                as_attachment=True,
                filename='network_model.xml'
            )
            
            # Let FileResponse handle closing the file
            return response

        except Exception as e:
            logger.exception("An error occurred while trying to download the SBML file")
            return HttpResponse(f"An error occurred: {str(e)}", status=500)

@method_decorator(csrf_exempt, name='dispatch')
class GetNodesView(View):
    def get(self, request):
        try:
            sbml_file_path = request.session.get('temp_sbml_path', '')
            if not sbml_file_path or not os.path.exists(sbml_file_path):
                return JsonResponse({'error': 'Temporary SBML file not found.'}, status=400)

            # Load the model using libSBML to get the most up-to-date values
            reader = libsbml.SBMLReader()
            document = reader.readSBML(sbml_file_path)
            model = document.getModel()
            
            original_concentrations = request.session.get('original_concentrations', {})
            clamped_nodes = request.session.get('clamped_nodes', {})
            
            nodes = []
            for species in model.getListOfSpecies():
                species_id = species.getId()
                default = _initial_value(species)
                nodes.append({
                    'id': species_id,
                    'name': species.getName() or species_id,
                    'clamped': species_id in clamped_nodes,
                    'current_value': clamped_nodes.get(species_id, default),
                    'original_concentration': original_concentrations.get(species_id, default),
                })
            
            return JsonResponse({'nodes': nodes})
        except Exception as e:
            logger.error(f"Error in GetNodesView: {str(e)}")
            logger.error(f"Traceback: {traceback.format_exc()}")
            return JsonResponse({'error': str(e)}, status=500)

@method_decorator(csrf_exempt, name='dispatch')
class ClampNodesView(View):
    """Apply the user's current clamp set to a fresh copy of the master SBML.

    This model is rate-rule-based: every species has a RateRule encoding its
    ODE. Setting ``boundaryCondition`` / ``constant`` alone does NOT prevent the
    integrator from advancing the species — the rate rule keeps firing.  So a
    proper clamp here also REMOVES the species's RateRule.  And to recover the
    rule when a clamp is later released, we always rebuild from the pristine
    master SBML rather than mutating the previous temp file.
    """

    def post(self, request):
        try:
            data = json.loads(request.body)
            clamped_nodes_in = data.get('clamped_nodes', [])

            sbml_file_path = request.session.get('temp_sbml_path', '')
            if not sbml_file_path:
                return JsonResponse({'success': False, 'message': 'No model session.'})

            # 1. Locate the pristine master SBML at the project root.
            master_candidates = glob.glob(os.path.join(settings.BASE_DIR, '*.xml'))
            if not master_candidates:
                return JsonResponse({'success': False,
                                     'message': 'Master SBML not found at project root.'})
            master_path = master_candidates[0]

            # 2. Reset the temp file from the master (recovers rules of any
            #    species the user just un-clamped).
            shutil.copy2(master_path, sbml_file_path)

            # 3. Apply each clamp by: removing the species's RateRule, setting
            #    its initial value to the clamp, and marking it boundary+constant.
            reader = libsbml.SBMLReader()
            document = reader.readSBML(sbml_file_path)
            model = document.getModel()

            clamped_dict = {}
            for node in clamped_nodes_in:
                species_id = node['id']
                try:
                    value = float(node['value'])
                except (TypeError, ValueError):
                    continue
                species = model.getSpecies(species_id)
                if species is None:
                    continue

                # Drop any rate rule that targets this species — without this,
                # the integrator would still advance it during simulate().
                for i in reversed(range(model.getNumRules())):
                    rule = model.getRule(i)
                    if rule.isRate() and rule.getVariable() == species_id:
                        model.removeRule(i)

                # Set initial value using whichever attribute the species carries.
                if species.isSetInitialConcentration():
                    species.setInitialConcentration(value)
                else:
                    species.setInitialAmount(value)

                # Mark as a true SBML constant. With the rate rule gone, this
                # is well-formed (SBML L3V2 forbids rules on constant species).
                species.setBoundaryCondition(True)
                species.setConstant(True)
                clamped_dict[species_id] = value

            libsbml.writeSBMLToFile(document, sbml_file_path)
            request.session['clamped_nodes'] = clamped_dict
            # Force last_state to be re-seeded from the new initial conditions.
            request.session.pop('last_state', None)

            return JsonResponse({'success': True, 'clamped': clamped_dict})

        except Exception as e:
            logger.error(f"Error in ClampNodesView: {str(e)}")
            logger.error(f"Traceback: {traceback.format_exc()}")
            return JsonResponse({
                'success': False,
                'error': str(e),
                'traceback': traceback.format_exc(),
            }, status=500)

@method_decorator(csrf_exempt, name='dispatch')
class CleanupTempFile(View):
    def post(self, request):
        try:
            data = json.loads(request.body)
            session_key = data.get('session_key')
            
            if session_key:
                temp_file_path = request.session.get('temp_sbml_path')
                if temp_file_path and os.path.exists(temp_file_path):
                    os.remove(temp_file_path)
                    del request.session['temp_sbml_path']
                    return HttpResponse(status=200)
            
            return HttpResponse(status=400)
        except Exception as e:
            logger.error(f"Error in CleanupTempFile: {str(e)}")
            return HttpResponse(status=500)

class CheckModelState(APIView):
    def get(self, request, format=None):
        try:
            if 'rr_model_sbml' in request.session:
                rr = roadrunner.RoadRunner(request.session['rr_model_sbml'])
                species_ids = rr.model.getFloatingSpeciesIds()
                current_concentrations = {s: rr.getValue(s) for s in species_ids}
                return JsonResponse({
                    'success': True,
                    'current_concentrations': current_concentrations
                })
            else:
                return JsonResponse({
                    'success': False,
                    'message': 'No model state found in session'
                })
        except Exception as e:
            logger.error(f"Error in CheckModelState: {str(e)}")
            return JsonResponse({
                'success': False,
                'message': f"An error occurred: {str(e)}"
            }, status=500)